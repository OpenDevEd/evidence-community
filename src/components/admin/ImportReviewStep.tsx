"use client";

import { ArrowLeft01Icon, ArrowRight01Icon, ArrowRight02Icon, CheckListIcon, FileEditIcon, FileExportIcon, Folder01Icon, HashtagIcon, LicenseIcon, PencilEdit02Icon, QuoteDownIcon, Route01Icon, SentIcon, SquareArrowUpRight02Icon, Tag01Icon, TextIcon, UserCheck01Icon, UserMultipleIcon } from "@hugeicons/core-free-icons";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState } from "react";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Checkbox } from "@/components/nextui/Checkbox";

import { ImportCover } from "./ImportCover";
import { ImportPager, pageOf } from "./ImportPager";
import { Abstract, AuthorList, CheckMeter, Checks, CitedList, creatorsLine, MetadataLine, openWithProperties, PdfPropertiesList, PLACEHOLDER_LINE, propertiesAside, ReadingPlaceholder, rowStatus, StatusText, ChoiceList, SuggestionList, TagList } from "./ImportReview";

import { humanizeAdminField } from "./admin-schema";
import { checkPasses, coverOf, existingKeyOf, importable, recordPayload, recordPayloadOf, rowPasses, rowTitle, writesProperties, type ChoiceKind, type ImportRow, type ReviewFilter } from "./admin-import";
import { useAdminSession } from "./AdminSessionProvider";
import { CollectionsSetting } from "./ImportAdd";
import { DoiChoice } from "./ImportDoneStep";
import { InspectorChoices } from "./InspectorChoices";
import { checkCountOf, countSummary, ListHeader, Setting, SettingsGroup, sheetTransition, SheetTabs, Tick } from "./import-parts";
import type { PdfProperties } from "@/lib/admin/pdf-record-mapping";
import type { ImportFlowState } from "./import-flow";
import { LicenceInput } from "./LicenceInput";
import { FileAccessInput } from "./FileAccessInput";
import { licenceComplete, licenceLabel, licenceShortName, recordLicenceSchema, type RecordLicence, fileAccessSchema } from "@/lib/licences";

const ROWS_PER_PAGE = 8;

/** Which records the review shows, in the same tabs as the sources on the Add step. */
export function ReviewTabs({ flow }: { flow: ImportFlowState }) {
	const { counts } = flow;
	const tabs: { count: number; id: ReviewFilter; label: string }[] = [
		{ count: counts.total, id: "all", label: "All" },
		{ count: counts.ready, id: "ready", label: "Ready" },
		{ count: counts.existing, id: "existing", label: "In the community" },
		{ count: counts.attention, id: "attention", label: "Needs attention" },
		...(flow.batch?.kind === "pdfs" ? [{ count: counts.improve, id: "improve" as const, label: "Checks to improve" }] : []),
	];
	return <SheetTabs label="Show" onSelect={flow.setFilter} panelId="import-review-panel" selected={flow.filter} tabs={tabs} />;
}

/**
 * The review, built like the Add step: the Collections setting at the top,
 * then the records as a list. A record opens as its own page in the sheet,
 * its parts in rows that open in place, with the way back and to the next.
 */
export function ImportReviewStep({ flow }: { flow: ImportFlowState }) {
	const reduceMotion = useReducedMotion();
	const [openId, setOpenId] = useState<string | null>(null);
	// Here rather than in the list, so coming back from a record keeps the page.
	const [page, setPage] = useState(1);
	const open = flow.shown.find(({ id }) => id === openId) ?? null;
	const back = () => {
		// The page holding the record last open, which Next may have moved past the one left.
		setPage(pageHolding(flow.shown, open));
		setOpenId(null);
	};
	// A record slides in from the right and the list from the left.
	const from = open ? 16 : -16;
	return (
		// Clips the 16 px slide between list and record, or the sheet scrolls sideways while it runs.
		<div aria-labelledby={`import-review-panel-tab-${flow.filter}`} className="relative flex min-h-0 flex-1 flex-col overflow-hidden" id="import-review-panel" role="tabpanel">
			<AnimatePresence initial={false} mode="popLayout">
				<motion.div
					animate={{ opacity: 1, x: 0 }}
					className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-5 pt-5 [scrollbar-gutter:stable]"
					exit={{ opacity: 0, x: -from }}
					initial={{ opacity: 0, x: from }}
					key={open ? "record" : "list"}
					transition={sheetTransition(reduceMotion, 0.18)}
				>
					<ReviewPage flow={flow} onBack={back} onOpen={setOpenId} onPage={setPage} open={open} page={page} />
				</motion.div>
			</AnimatePresence>
		</div>
	);
}

/** The list page holding a record, or the first page when none was open. */
function pageHolding(rows: ImportRow[], row: ImportRow | null) {
	return row ? Math.floor(rows.indexOf(row) / ROWS_PER_PAGE) + 1 : 1;
}

function ReviewPage({ flow, onBack, onOpen, onPage, open, page }: { flow: ImportFlowState; onBack: () => void; onOpen: (id: string) => void; onPage: (page: number) => void; open: ImportRow | null; page: number }) {
	if (open) return <RecordPage flow={flow} key={open.id} onBack={onBack} onOpen={onOpen} row={open} />;
	return <RecordList flow={flow} onOpen={onOpen} onPage={onPage} page={page} />;
}

// The draft importing made from this row, once it has.
const draftKeyOf = (flow: ImportFlowState, row: ImportRow) => flow.resultById.get(row.id)?.itemKey;
const statusOf = (flow: ImportFlowState, row: ImportRow) => rowStatus(row, flow.resultById.get(row.id), flow.batch?.attach.get(row.id), flow.needsOf(row));
// The checks the PDFs were read against, which a suggestion names by their place.
const batchChecks = (flow: ImportFlowState) => flow.batch?.checks ?? [];

function choose(flow: ImportFlowState, id: string, checked: boolean) {
	const next = new Set(flow.selected);
	if (checked) next.add(id);
	else next.delete(id);
	flow.setSelected(next);
}

function RecordList({ flow, onOpen, onPage, page }: { flow: ImportFlowState; onOpen: (id: string) => void; onPage: (page: number) => void; page: number }) {
	const { current, items, pages } = pageOf(flow.shown, page, ROWS_PER_PAGE);
	return (
		<div className="flex flex-col gap-5">
			<SettingsGroup>
				<CollectionsSetting flow={flow} />
				{flow.batch?.kind === "pdfs" ? <OutcomeSetting flow={flow} /> : null}
			</SettingsGroup>
			<div className="flex flex-col gap-2">
				<ListHeader aside={readingAside(flow)} lead={<ChooseEvery flow={flow} />} title={`${flow.selected.size} of ${flow.readyIds.length} chosen`} />
				<ul className="flex flex-col">
					{items.map((row) => (
						<RecordListRow flow={flow} key={row.id} onOpen={onOpen} row={row} />
					))}
					{items.length ? null : <li className="flex h-28 items-center justify-center text-sm text-black/45 dark:text-white/45">Nothing here</li>}
				</ul>
				<ImportPager label="Pages of records" onChange={onPage} page={current} pages={pages} perPage={ROWS_PER_PAGE} total={flow.shown.length} />
			</div>
		</div>
	);
}

/** How far reading has got, while the worker still reads the import's PDFs. */
const readingAside = (flow: ImportFlowState) => (flow.batch?.kind === "pdfs" && flow.reading ? `${flow.counts.done} of ${flow.counts.total} read` : undefined);

// No tick to choose every record until one is ready, or while the import is on its way.
const choosingAll = (flow: ImportFlowState) => flow.readyIds.length > 0 && !flow.locked;

function ChooseEvery({ flow }: { flow: ImportFlowState }) {
	const all = flow.readyIds.length > 0 && flow.readyIds.every((id) => flow.selected.has(id));
	return <Tick>{choosingAll(flow) ? <Checkbox aria-label="Choose every ready record" isIndeterminate={flow.selected.size > 0 && !all} isSelected={all} onValueChange={(checked) => flow.setSelected(new Set(checked ? flow.readyIds : []))} size="sm" /> : null}</Tick>;
}

// A title the record has, or the file's name in a quieter colour while it has none.
const titleTone = (row: ImportRow, titled: string, untitled: string) => (row.record?.title ? titled : untitled);

function RecordListRow({ flow, onOpen, row }: { flow: ImportFlowState; onOpen: (id: string) => void; row: ImportRow }) {
	const title = rowTitle(row);
	return (
		<li className="flex items-center gap-3 rounded-lg pe-1 ps-1.5 hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
			{/* A record still reading, or that can't be imported, has no tick until it can, and none has while the import is on its way. */}
			<Tick>{importable(row) && !flow.locked ? <Checkbox aria-label={`Import ${title}`} isSelected={flow.selected.has(row.id)} onValueChange={(checked) => choose(flow, row.id, checked)} size="sm" /> : null}</Tick>
			<button className="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-md py-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={() => onOpen(row.id)} type="button">
				<ImportCover className="w-8 self-start" {...coverOf(row)} size={12} />
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className={`line-clamp-2 text-sm leading-5 ${titleTone(row, "font-medium text-black/85 dark:text-white/85", "text-black/45 dark:text-white/45")}`}>{title}</span>
					<span className="flex items-center gap-2">
						<RowLine flow={flow} row={row} />
						<CheckMeter checks={flow.checksOf(row)} count={checkCountOf(flow, row)} />
					</span>
				</span>
				<HugeiconsIcon aria-hidden className="shrink-0 text-black/30 dark:text-white/30" icon={ArrowRight01Icon} size={15} />
			</button>
		</li>
	);
}

/** Under a ready record's title, who wrote it; under any other, where it has got to. */
function RowLine({ flow, row }: { flow: ImportFlowState; row: ImportRow }) {
	const status = statusOf(flow, row);
	if (status.label === "Ready" && row.record) return <span className="min-w-0 flex-1 truncate text-xs text-black/50 dark:text-white/50">{creatorsLine(row.record.creators) || "No authors"}</span>;
	return (
		<span className="min-w-0 flex-1">
			<StatusText status={status} />
		</span>
	);
}

/** Why a record can't be imported: each field it gets wrong, or the general message. */
function attentionReason(record: NonNullable<ImportRow["record"]>) {
	const fields = Object.entries(record.fields ?? {});
	return fields.length ? fields.map(([field, message]) => `${humanizeAdminField(field)}: ${message}`).join(" ") : record.message;
}

/** One record as its own page: who wrote it, then its parts in rows like the Add step's settings. */
function RecordPage({ flow, onBack, onOpen, row }: { flow: ImportFlowState; onBack: () => void; onOpen: (id: string) => void; row: ImportRow }) {
	const applied = flow.appliedFor(row);
	const edited = recordPayload(row, applied, flow.licenceOf(row), flow.fileAccessOf(row));
	const properties = flow.propertiesOf(row);
	const settled = row.state === "read" || row.state === "failed";
	return (
		<div className="flex flex-col gap-5">
			<RecordNav flow={flow} onBack={onBack} onOpen={onOpen} row={row} />
			<header className="flex gap-4">
				<ImportCover className="w-16 self-start" {...coverOf(row)} size={18} />
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<RecordTitle flow={flow} row={row} />
					<RecordState flow={flow} row={row} />
				</div>
			</header>
			{row.record ? <MetadataLine payload={edited} /> : null}
			{settled ? <RecordParts applied={applied} edited={edited} flow={flow} properties={properties} row={row} /> : <ReadingPlaceholder />}
			<RecordActions flow={flow} properties={properties} row={row} />
		</div>
	);
}

function RecordNav({ flow, onBack, onOpen, row }: { flow: ImportFlowState; onBack: () => void; onOpen: (id: string) => void; row: ImportRow }) {
	const index = flow.shown.findIndex(({ id }) => id === row.id);
	const previous = flow.shown[index - 1];
	const next = flow.shown[index + 1];
	return (
		<div className="-mx-1.5 -mt-2 flex h-9 items-center gap-1">
			<Button onPress={onBack} size="xs" startContent={<HugeiconsIcon aria-hidden icon={ArrowLeft01Icon} size={14} />} variant="transparent">
				All records
			</Button>
			<span className="ms-auto text-xs tabular-nums text-black/45 dark:text-white/45">
				{index + 1} of {flow.shown.length}
			</span>
			<Button aria-label="Previous record" className="size-8 min-w-8" isDisabled={!previous} isIconOnly onPress={() => previous && onOpen(previous.id)} size="xs" variant="transparent">
				<HugeiconsIcon aria-hidden icon={ArrowLeft01Icon} size={15} />
			</Button>
			<Button aria-label="Next record" className="size-8 min-w-8" isDisabled={!next} isIconOnly onPress={() => next && onOpen(next.id)} size="xs" variant="transparent">
				<HugeiconsIcon aria-hidden icon={ArrowRight01Icon} size={15} />
			</Button>
		</div>
	);
}

/** What kind of record it is and when it appeared, as far as the reading says. */
function kindLine(record: ImportRow["record"]) {
	if (!record) return [];
	return [record.itemType ? humanizeAdminField(record.itemType) : null, record.year].filter(Boolean);
}

// While the PDF is read, pulsing lines hold the places of the type, the year and the authors, so the title sits as it will.
const readingRow = (row: ImportRow) => row.state !== "read" && row.state !== "failed";

function RecordTitle({ flow, row }: { flow: ImportFlowState; row: ImportRow }) {
	return (
		<>
			<div className="flex h-4 items-center gap-3 text-xs text-black/45 dark:text-white/45">
				<RecordKind row={row} />
				{/* The checks as the list shows them, at the end of the line like a badge: grey bars while the PDF is read, then how it did. */}
				<span className="ms-auto">
					<CheckMeter checks={flow.checksOf(row)} count={checkCountOf(flow, row)} />
				</span>
			</div>
			<h3 className={`text-base font-semibold leading-6 ${titleTone(row, "text-black/90 dark:text-white/90", "text-black/40 dark:text-white/40")}`}>{rowTitle(row)}</h3>
			<RecordAuthors row={row} />
		</>
	);
}

function RecordKind({ row }: { row: ImportRow }) {
	if (readingRow(row)) {
		return (
			<>
				<span aria-hidden className={`${PLACEHOLDER_LINE} w-16`} />
				<span aria-hidden className={`${PLACEHOLDER_LINE} w-8`} />
			</>
		);
	}
	return (
		<span className="flex min-w-0 gap-3 truncate">
			{kindLine(row.record).map((part) => (
				<span key={String(part)}>{part}</span>
			))}
		</span>
	);
}

// What the authors line says once reading is over: who wrote it, or that the reading named no one, as the list says; a
// failed read says nothing, but the line keeps its height.
const authorsText = (record: ImportRow["record"]) => (record ? record.creators.join(", ") || "No authors" : "");

// The line stays once the PDF is read, so the rows below don't move up.
function RecordAuthors({ row }: { row: ImportRow }) {
	if (readingRow(row)) {
		return (
			<p aria-hidden className="flex h-5 items-center">
				<span className={`${PLACEHOLDER_LINE} w-40`} />
			</p>
		);
	}
	return <p className="min-h-5 text-sm text-black/60 dark:text-white/60">{authorsText(row.record)}</p>;
}

/** Where the record has got to, whether it is chosen, and what stops it. */
function RecordState({ flow, row }: { flow: ImportFlowState; row: ImportRow }) {
	return (
		<>
			{/* A long status wraps beside the tick, which keeps to one line at the top. */}
			<div className="mt-1 flex items-start gap-3">
				<StatusText status={statusOf(flow, row)} wrap />
				{importable(row) ? (
					<span className="ms-auto shrink-0 whitespace-nowrap">
						<Checkbox isDisabled={flow.locked} isSelected={flow.selected.has(row.id)} onValueChange={(checked) => choose(flow, row.id, checked)} size="sm">
							<span className="text-xs text-black/70 dark:text-white/70">Import this record</span>
						</Checkbox>
					</span>
				) : null}
			</div>
			{row.message ? <p className="text-xs text-danger">{row.message}</p> : null}
			<AttentionReason record={row.record} />
		</>
	);
}

function AttentionReason({ record }: { record: ImportRow["record"] }) {
	if (record?.state !== "attention") return null;
	return <p className="text-xs leading-5 text-danger">{attentionReason(record)}</p>;
}

type PartProps = { applied: ReadonlySet<number>; edited: Record<string, unknown>; flow: ImportFlowState; properties: PdfProperties; row: ImportRow };

/** The record's parts, each a row that opens in place; a part with nothing in it isn't shown. */
function RecordParts(props: PartProps) {
	return (
		<div className="animate-fade-in [animation-duration:300ms]">
			<SettingsGroup>
				<AbstractPart {...props} />
				<ChecksPart {...props} />
				<AuthorsPart {...props} />
				<TagsPart {...props} />
				<CitesPart {...props} />
				<SuggestionsPart {...props} />
				<LicencePart {...props} />
				<ChoicePart {...props} icon={Tag01Icon} kind="topics" title="Topics" />
				<ChoicePart {...props} icon={Folder01Icon} kind="collections" title="Collections" />
				<PropertiesPart {...props} />
			</SettingsGroup>
		</div>
	);
}

function AbstractPart({ applied, edited, row }: PartProps) {
	if (typeof edited.abstractNote !== "string" || !edited.abstractNote) return null;
	const written = row.suggestions.some(({ field }, index) => field === "abstractNote" && applied.has(index));
	return (
		<Setting icon={TextIcon} summary={written ? "Written by AI" : "From the PDF"} title="Abstract">
			<Abstract text={edited.abstractNote} />
		</Setting>
	);
}

function ChecksPart({ applied, flow, row }: PartProps) {
	if (!row.source || !flow.checkCount) return null;
	const checks = flow.checksOf(row);
	return (
		<Setting defaultOpen={!rowPasses(row, applied)} icon={CheckListIcon} summary={`${checks.filter(checkPasses).length} of ${flow.checkCount} pass`} title="AI checks">
			<Checks checks={checks} />
		</Setting>
	);
}

type Creators = Parameters<typeof AuthorList>[0]["creators"];

function AuthorsPart({ edited }: PartProps) {
	const creators = Array.isArray(edited.creators) ? (edited.creators as Creators) : [];
	if (!creators.length) return null;
	const affiliated = creators.filter(({ institutions }) => institutions?.length).length;
	const linked = creators.filter(({ authorProfileId }) => authorProfileId).length;
	return (
		<Setting icon={UserMultipleIcon} summary={[`${affiliated} of ${creators.length} with affiliations`, linked ? `${linked} linked to profiles` : ""].filter(Boolean).join(", ")} title="Authors">
			<AuthorList creators={creators} />
		</Setting>
	);
}

function TagsPart({ edited }: PartProps) {
	const tags = Array.isArray(edited.tags) ? (edited.tags as string[]) : [];
	if (!tags.length) return null;
	return (
		<Setting icon={HashtagIcon} summary={countSummary(tags.length, "keyword", "keywords", "")} title="Tags">
			<TagList tags={tags} />
		</Setting>
	);
}

function CitesPart({ row }: PartProps) {
	if (!row.cites.length) return null;
	return (
		<Setting icon={QuoteDownIcon} summary={countSummary(row.cites.length, "record", "records", "")} title="Cites in the community">
			<CitedList cites={row.cites} />
		</Setting>
	);
}

function SuggestionsPart({ applied, flow, row }: PartProps) {
	if (!row.suggestions.length) return null;
	return (
		<Setting defaultOpen={row.suggestions.some((_, index) => !applied.has(index))} icon={PencilEdit02Icon} summary={`${applied.size} of ${row.suggestions.length} applied`} title="Suggested changes">
			<SuggestionList applied={applied} checks={batchChecks(flow)} locked={flow.locked} onToggle={(index) => flow.toggleSuggestion(row.id, index)} payload={recordPayloadOf(row)} suggestions={row.suggestions} />
		</Setting>
	);
}

/** The topics or collections the AI chose from the library's own lists, which the editor keeps or drops. */
function ChoicePart({ flow, icon, kind, row, title }: PartProps & { icon: typeof Tag01Icon; kind: ChoiceKind; title: string }) {
	const choices = row[kind];
	if (!choices.length) return null;
	const chosen = flow.choicesOf(row, kind);
	return (
		<Setting icon={icon} summary={`${chosen.size} of ${choices.length} chosen`} title={title}>
			<ChoiceList chosen={chosen} choices={choices} locked={flow.locked} onToggle={(id) => flow.toggleChoice(row.id, kind, id)} />
		</Setting>
	);
}

/** MOCK: a PDF without a DOI becomes a record made here, which can get a DOI and so has a licence. */
const makesRecord = (row: ImportRow, edited: Record<string, unknown>) => Boolean(row.source) && !(typeof edited.DOI === "string" && edited.DOI.trim());
const rightsOf = (edited: Record<string, unknown>) => (typeof edited.rights === "string" ? edited.rights : "");
/** Whether the chosen records are sent on with a DOI as soon as they're in, which needs each one's licence now. */
const sendsWithDoi = (flow: ImportFlowState) => flow.batch?.outcome === "send" && Boolean(flow.batch.publishRoute);

/** The licence row's summary: the licence, or what it still needs, in red when a DOI waits for it. */
function licenceSummary(licence: RecordLicence | null, needed: boolean) {
	if (licenceComplete(licence)) return licenceLabel(licence);
	return <span className={needed ? "text-danger" : undefined}>{licence ? "Needs its name and link" : "None found"}</span>;
}

/** The record's licence as the review has it: what its PDF named, or what the editor picked. */
const licenceIn = (edited: Record<string, unknown>) => recordLicenceSchema.safeParse(edited.licence).data ?? null;

/** The chosen records that would go out with a DOI and no licence. */
function withoutLicence(flow: ImportFlowState) {
	if (!sendsWithDoi(flow)) return [];
	return flow.rows.filter((row) => {
		if (!flow.selected.has(row.id) || row.state !== "read") return false;
		const edited = recordPayload(row, flow.appliedFor(row), flow.licenceOf(row));
		return makesRecord(row, edited) && !licenceComplete(licenceIn(edited));
	});
}

function missingWords(count: number, defaultLicence: string) {
	const name = licenceShortName(defaultLicence) ?? "the default licence";
	return count === 1
		? { note: "1 record has no licence in its PDF. It needs one for its DOI.", action: `Use ${name} for it` }
		: { note: `${count} records have no licence in their PDFs. Each needs one for its DOI.`, action: `Use ${name} for them` };
}

/** The licence the PDF's rights name, or none: an import never takes the default by itself. */
function LicencePart({ edited, flow, row }: PartProps) {
	const { defaultLicence } = useAdminSession();
	if (!makesRecord(row, edited)) return null;
	const licence = licenceIn(edited);
	const needed = sendsWithDoi(flow);
	return (
		<Setting defaultOpen={needed && !licenceComplete(licence)} icon={LicenseIcon} summary={licenceSummary(licence, needed)} title="Licence">
			<div className="space-y-2">
				<LicenceInput value={licence} rights={rightsOf(edited)} defaultLicence={defaultLicence} needed={needed} disabled={flow.locked} onChange={(picked) => picked && flow.setLicence([row.id], picked)} />
				<RowFileAccess edited={edited} flow={flow} licence={licence} row={row} />
			</div>
		</Setting>
	);
}

/** Who gets the record's file, once it has a licence to choose under. */
function RowFileAccess({ edited, flow, licence, row }: { edited: Record<string, unknown>; flow: ImportFlowState; licence: RecordLicence | null; row: ImportRow }) {
	const { defaultFileAccess } = useAdminSession();
	if (!licence) return null;
	// Nobody chose for this row: it gets the community's default, as it will once imported.
	return <FileAccessInput licence={licence} value={fileAccessSchema.safeParse(edited.fileAccess).data ?? defaultFileAccess} disabled={flow.locked} onChange={(access) => flow.setFileAccess(row.id, access)} />;
}

/** The chosen records a DOI would go out without a licence for, with the default offered for all of them at once. */
function MissingLicences({ flow }: { flow: ImportFlowState }) {
	const { defaultLicence } = useAdminSession();
	const missing = withoutLicence(flow);
	if (!missing.length) return null;
	const words = missingWords(missing.length, defaultLicence);
	return (
		<div role="alert" className="flex items-center gap-3 rounded-xl bg-danger/5 px-3 py-2.5 text-xs text-danger">
			<p className="min-w-0 flex-1 leading-5">{words.note}</p>
			<Button className="shrink-0" isDisabled={flow.locked} onPress={() => flow.setLicence(missing.map(({ id }) => id), { kind: "zenodo", id: defaultLicence })} size="xs" variant="muted">
				{words.action}
			</Button>
		</div>
	);
}

function PropertiesPart({ properties, row }: PartProps) {
	if (!row.source || !row.record || !row.pdf) return null;
	return (
		<Setting icon={FileEditIcon} summary={propertiesAside(properties, row.pdf)} title="PDF properties">
			<PdfPropertiesList after={properties} now={row.pdf} />
		</Setting>
	);
}

/** The PDF as it is and as publishing writes it, and the draft or record importing made or found. */
function RecordActions({ flow, properties, row }: { flow: ImportFlowState; properties: PdfProperties; row: ImportRow }) {
	return (
		<div className="flex flex-wrap gap-2 empty:hidden">
			<PdfButtons properties={properties} row={row} />
			<OpenRecordButton flow={flow} row={row} />
		</div>
	);
}

function PdfButtons({ properties, row }: { properties: PdfProperties; row: ImportRow }) {
	const url = row.source?.url;
	if (!url) return null;
	return (
		<>
			<Button onPress={() => window.open(url, "_blank", "noopener")} size="xs" startContent={<HugeiconsIcon aria-hidden icon={SquareArrowUpRight02Icon} size={13} />} variant="muted">
				Open PDF
			</Button>
			{writesProperties(row) ? (
				<Button onPress={() => void openWithProperties(url, properties)} size="xs" startContent={<HugeiconsIcon aria-hidden icon={FileExportIcon} size={13} />} variant="muted">
					Open with new properties
				</Button>
			) : null}
		</>
	);
}

function OpenRecordButton({ flow, row }: { flow: ImportFlowState; row: ImportRow }) {
	const draftKey = draftKeyOf(flow, row);
	const openKey = draftKey ?? existingKeyOf(row);
	if (!openKey) return null;
	return (
		<Button onPress={() => flow.onOpenRecord(openKey)} size="xs" startContent={<HugeiconsIcon aria-hidden icon={ArrowRight02Icon} size={13} />} variant="muted">
			{draftKey ? "Open the draft" : "Open the record"}
		</Button>
	);
}

/** What sending a draft on is for this person: publishing it, or submitting it to an editor. */
function sendWords(canPublish: boolean) {
	return canPublish ? { icon: SentIcon, label: "Publish", note: "Each record is published as soon as its PDF is attached." } : { icon: UserCheck01Icon, label: "Send to queue", note: "Each record goes to an editor for review as soon as its PDF is attached." };
}

const optionContent = (icon: typeof SentIcon, label: string) => (
	<span className="flex items-center gap-1.5">
		<HugeiconsIcon aria-hidden icon={icon} size={14} />
		{label}
	</span>
);

/**
 * What importing does with the chosen records. As drafts they can be edited
 * in the record editor first, then published or submitted from the finish
 * step or the editor; otherwise the server sends each on as soon as its PDF
 * is attached, with the DOI choice it would get in the finish step.
 */
function OutcomeSetting({ flow }: { flow: ImportFlowState }) {
	const { canPublish } = useAdminSession();
	const outcome = flow.batch!.outcome;
	const send = sendWords(canPublish);
	return (
		<Setting icon={Route01Icon} summary={outcome === "send" ? send.label : "Drafts"} title="After import">
			<div className="flex flex-col gap-3">
				<InspectorChoices
					disabled={flow.locked}
					label="After import"
					onChange={flow.setOutcome}
					options={[
						{ content: optionContent(PencilEdit02Icon, "Drafts"), key: "drafts", label: "Drafts" },
						{ content: optionContent(send.icon, send.label), key: "send", label: send.label },
					]}
					value={outcome}
					variant="inset"
				/>
				<p className="text-xs leading-5 text-black/50 dark:text-white/50">{outcome === "send" ? send.note : "Edit them in the record editor first, then publish or submit them from the finish step or the editor."}</p>
				{outcome === "send" ? <DoiChoice flow={flow} route={flow.batch!.publishRoute} started={flow.locked} /> : null}
				<MissingLicences flow={flow} />
			</div>
		</Setting>
	);
}
